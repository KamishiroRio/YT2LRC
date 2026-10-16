import { defineFunction } from '@aws-amplify/backend';

export const getSignedLrcUrl = defineFunction({
  name: 'getSignedLrcUrl',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 30,
  memoryMB: 256,
  resourceGroupName: 'data',
});
