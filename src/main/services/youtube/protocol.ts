// Tin nhắn giữa main và worker upload. Worker chỉ nhận access token ngắn hạn, không bao giờ nhận refresh token.

export type ToWorker =
  | { type: 'start'; id: string; filePath: string; size: number; mime: string; title: string; session: string | null; accessToken: string }
  | { type: 'token'; id: string; accessToken: string }
  | { type: 'abort'; id: string };

export type FromWorker =
  | { type: 'session'; id: string; url: string }
  | { type: 'progress'; id: string; sent: number; size: number }
  | { type: 'needToken'; id: string }
  | { type: 'done'; id: string; videoId: string; privacy: string | null; uploadStatus: string | null }
  | { type: 'adsDone'; id: string; resourceName: string } // chỉ phát trong main (upload qua Google Ads)
  | { type: 'aborted'; id: string }
  | { type: 'error'; id: string; status: number | null; reason: string | null; message: string; sessionGone: boolean };
