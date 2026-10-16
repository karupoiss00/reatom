import { abortVar, action, atom, wrap } from '@reatom/core'

import { otel } from '../setup'
import { SearchFilters, IssuesResponse, Label } from './types'

export const githubAuth = atom({ token: '' }, 'github.auth')

const githubAcceptHeaders = (token: string) => {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

const originOf = (value: string | undefined) => {
  if (!value) return
  try {
    return new URL(value).origin
  } catch {
    return
  }
}

const isTraceparentOrigin = (url: string) => {
  const requestOrigin = originOf(url)
  if (!requestOrigin) return false
  const allowed = new Set<string>()
  const collectorOrigin = originOf(import.meta.env.VITE_OTEL_ENDPOINT)
  if (collectorOrigin) allowed.add(collectorOrigin)
  if (typeof location !== 'undefined') allowed.add(location.origin)
  return allowed.has(requestOrigin)
}

const headersFor = (url: string, token: string) => {
  const headers = githubAcceptHeaders(token)
  if (!isTraceparentOrigin(url)) return headers
  const traceparent = otel.traceparent()
  return traceparent ? { ...headers, traceparent } : headers
}

const fetchGithub = async (
  url: string,
  token: string,
  signal?: AbortSignal,
) => {
  return await wrap(fetch(url, { signal, headers: headersFor(url, token) }))
}

const enhanceIssue = (issue: {
  repository_url: string
  [key: string]: unknown
}) => {
  const repoUrlParts = issue.repository_url.split('/')
  const repoOwner = repoUrlParts[repoUrlParts.length - 2]
  const repoName = repoUrlParts[repoUrlParts.length - 1]

  return {
    ...issue,
    repository: {
      name: repoName,
      full_name: `${repoOwner}/${repoName}`,
      html_url: `https://github.com/${repoOwner}/${repoName}`,
    },
  }
}

export const searchIssues = action(async (filters: SearchFilters) => {
  let q = filters.query

  if (filters.state) {
    q += ` state:${filters.state}`
  }

  if (filters.labels && filters.labels.length > 0) {
    filters.labels.forEach((label) => {
      q += ` label:"${label}"`
    })
  }

  if (filters.language) {
    q += ` language:${filters.language}`
  }

  if (filters.author) {
    q += ` author:${filters.author}`
  }

  if (filters.assignee) {
    q += ` assignee:${filters.assignee}`
  }

  if (filters.mentions) {
    q += ` mentions:${filters.mentions}`
  }

  const params = new URLSearchParams({
    q,
    page: filters.page.toString(),
    per_page: filters.perPage.toString(),
  })

  if (filters.sort) {
    params.append('sort', filters.sort)
  }

  if (filters.direction) {
    params.append('order', filters.direction)
  }

  const url = `https://api.github.com/search/issues?${params.toString()}`
  const { token } = githubAuth()
  const response = await fetchGithub(url, token, abortVar.get()?.signal)

  if (!response.ok) {
    const error = new Error(`HTTP Error: ${response.statusText}`)
    const meta = await wrap(response.json().catch(() => ({})))
    throw Object.assign(error, meta)
  }

  const data = (await wrap(response.json())) as IssuesResponse & {
    items: Array<{ repository_url: string; [key: string]: unknown }>
  }

  return {
    ...data,
    items: data.items.map(enhanceIssue),
  } as IssuesResponse
}, 'github.searchIssues').extend(otel.withOTel({ kind: 'client' }))

export const mockLabels: Label[] = [
  {
    id: 1,
    name: 'bug',
    color: 'd73a4a',
    description: "Something isn't working",
  },
  {
    id: 2,
    name: 'enhancement',
    color: 'a2eeef',
    description: 'A new feature or request',
  },
  {
    id: 3,
    name: 'documentation',
    color: '0075ca',
    description: 'Improvements or additions to documentation',
  },
  {
    id: 4,
    name: 'good first issue',
    color: '7057ff',
    description: 'Good for newcomers',
  },
  {
    id: 5,
    name: 'help wanted',
    color: '008672',
    description: 'Extra attention is needed',
  },
]

export const fetchLabels = async (): Promise<Label[]> => {
  return mockLabels
}

export const mockLanguages: string[] = [
  'JavaScript',
  'TypeScript',
  'Python',
  'Java',
  'Go',
  'Rust',
  'C#',
  'C++',
  'PHP',
  'Ruby',
]

export const fetchPopularLanguages = async (): Promise<string[]> => {
  return mockLanguages
}
