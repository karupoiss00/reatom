const secretKey = /sk-or-[^\s"\\]*/g

export const redactSecrets = (value: string) => value.replace(secretKey, '')
