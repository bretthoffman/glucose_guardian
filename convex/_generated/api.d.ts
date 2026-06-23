/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as cgm_config from "../cgm/config.js";
import type * as cgm_core from "../cgm/core.js";
import type * as cgm_providers from "../cgm/providers.js";
import type * as cgmIngest from "../cgmIngest.js";
import type * as crons from "../crons.js";
import type * as doctor from "../doctor.js";
import type * as doctorAccounts from "../doctorAccounts.js";
import type * as patientCgm from "../patientCgm.js";
import type * as patientDexcomSecrets from "../patientDexcomSecrets.js";
import type * as patientGlucose from "../patientGlucose.js";
import type * as patientLibreSecrets from "../patientLibreSecrets.js";
import type * as patientProfile from "../patientProfile.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  "cgm/config": typeof cgm_config;
  "cgm/core": typeof cgm_core;
  "cgm/providers": typeof cgm_providers;
  cgmIngest: typeof cgmIngest;
  crons: typeof crons;
  doctor: typeof doctor;
  doctorAccounts: typeof doctorAccounts;
  patientCgm: typeof patientCgm;
  patientDexcomSecrets: typeof patientDexcomSecrets;
  patientGlucose: typeof patientGlucose;
  patientLibreSecrets: typeof patientLibreSecrets;
  patientProfile: typeof patientProfile;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
