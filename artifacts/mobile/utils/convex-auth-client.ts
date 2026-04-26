import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";

export function getExpoConvexUrl(): string {
  const url = process.env.EXPO_PUBLIC_CONVEX_URL?.trim();
  if (!url) {
    throw new Error("EXPO_PUBLIC_CONVEX_URL is not set. Add it to artifacts/mobile/.env");
  }
  return url;
}

export function createConvexAuthClient(): ConvexHttpClient {
  return new ConvexHttpClient(getExpoConvexUrl());
}

export { api };
