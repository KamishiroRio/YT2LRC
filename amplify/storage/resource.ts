import { defineStorage } from '@aws-amplify/backend';
export const storage = defineStorage({
  name: 'yt2lrcLrcStorage',
  access: allow => ({
    'lrc/*': [allow.authenticated.to(['read','write'])],
  }),
});