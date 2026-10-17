import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { preview } from '../functions/preview/resource';
import { startJob } from '../functions/startJob/resource';
import { fetchLyrics } from '../functions/fetchLyrics/resource';
import { getSignedLrcUrl } from '../functions/getSignedLrcUrl/resource';

const schema = a.schema({
  Job: a
    .model({
      trackId: a.string().required(),
      youtubeUrl: a.string().required(),
      title: a.string(),
      artist: a.string(),
      lyrics: a.string(),
      status: a.enum([
        'QUEUED',
        'DOWNLOADING',
        'SEPARATING',
        'ALIGNING',
        'DONE',
        'FAILED',
      ]),
      progressLog: a.string(), // newline-joined log lines
      lrcKey: a.string(), // S3 object key of the .lrc
      owner: a.string(),
    })
    .authorization((allow) => [allow.owner()]),

  PreviewCandidate: a.customType({
    title: a.string().required(),
    artist: a.string().required(),
    url: a.string().required(),
  }),

  PreviewResult: a.customType({
    title: a.string(),
    artist: a.string(),
    lyrics: a.string(),
    candidates: a.ref('PreviewCandidate').array(),
  }),

  LyricsResult: a.customType({
    lyrics: a.string(),
  }),

  SignedUrlResult: a.customType({
    url: a.string(),
  }),

  preview: a
    .query()
    .arguments({ youtubeUrl: a.string().required() })
    .returns(a.ref('PreviewResult'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(preview)),

  startJob: a
    .mutation()
    .arguments({
      trackId: a.string().required(),
      youtubeUrl: a.string().required(),
      lyrics: a.string().required(),
      title: a.string(),
      artist: a.string(),
      audioKey: a.string(),
    })
    .returns(a.ref('Job'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(startJob)),

  fetchLyrics: a
    .query()
    .arguments({ url: a.string().required() })
    .returns(a.ref('LyricsResult'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(fetchLyrics)),

  getSignedLrcUrl: a
    .query()
    .arguments({ key: a.string().required() })
    .returns(a.ref('SignedUrlResult'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(getSignedLrcUrl)),
}).authorization((allow) => [allow.resource(startJob)]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
