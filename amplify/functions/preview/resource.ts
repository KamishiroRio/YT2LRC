import { defineFunction } from '@aws-amplify/backend';

export const preview = defineFunction({
  name: 'preview',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 30,
  memoryMB: 512,
  resourceGroupName: 'data',
});
