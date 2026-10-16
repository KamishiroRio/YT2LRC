import { defineFunction } from '@aws-amplify/backend';

export const fetchLyrics = defineFunction({
  name: 'fetchLyrics',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 30,
  memoryMB: 512,
  resourceGroupName: 'data',
});
