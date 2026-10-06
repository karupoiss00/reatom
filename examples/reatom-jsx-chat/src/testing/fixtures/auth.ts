export const exchangedKey = {
  key: 'sk-or-v1-exchanged',
  user_id: 'user_fixture',
}

export const expiredAuthCode = {
  status: 403,
  body: {
    error: {
      code: 403,
      message: 'Authorization code expired',
    },
  },
}
