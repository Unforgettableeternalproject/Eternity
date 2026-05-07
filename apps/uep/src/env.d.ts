/// <reference path="../.astro/types.d.ts" />

declare namespace App {
  interface Locals {
    user?: {
      username: string;
      role: string;
      displayName: string;
    };
    /** Cloudflare Pages runtime — 僅在 production 環境存在 */
    runtime?: {
      env: {
        JWT_SECRET?: string;
        [key: string]: unknown;
      };
    };
  }
}
