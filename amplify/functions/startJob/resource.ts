import { defineFunction } from '@aws-amplify/backend';

export const startJob = defineFunction({
  name: 'startJob',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 15,
  memoryMB: 512,
  resourceGroupName: 'data',
});
