import { Button, Popover, PasswordInput, Stack, Text } from '@mantine/core'
import { IconKey } from '@tabler/icons-react'
import { wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'

import { githubAuth } from '../../api/github'

export const GitHubAuthPanel = reatomComponent(() => {
  const { token } = githubAuth()
  const hasToken = token.length > 0

  return (
    <Popover width={320} position="bottom-end" shadow="md">
      <Popover.Target>
        <Button
          variant="default"
          size="compact-sm"
          leftSection={<IconKey size={16} />}
        >
          {hasToken ? 'GitHub token set' : 'GitHub token'}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm">
          <Text size="sm" fw={600}>
            Optional GitHub token
          </Text>
          <Text size="xs" c="dimmed">
            Used only as an Authorization header. The token field is redacted in
            telemetry.
          </Text>
          <PasswordInput
            label="token"
            placeholder="ghp_…"
            value={token}
            onChange={wrap((event) =>
              githubAuth.set({ token: event.currentTarget.value }),
            )}
          />
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}, 'GitHubAuthPanel')
