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
import type * as cgm_diagnostics from "../cgm/diagnostics.js";
import type * as cgm_providers from "../cgm/providers.js";
import type * as cgmDiagnostics from "../cgmDiagnostics.js";
import type * as cgmIngest from "../cgmIngest.js";
import type * as crons from "../crons.js";
import type * as doctor from "../doctor.js";
import type * as doctorAccounts from "../doctorAccounts.js";
import type * as guardianPin_config from "../guardianPin/config.js";
import type * as guardianPin_hashNode from "../guardianPin/hashNode.js";
import type * as guardianPin_internal from "../guardianPin/internal.js";
import type * as guardianPin_validate from "../guardianPin/validate.js";
import type * as patientCgm from "../patientCgm.js";
import type * as patientCgmSync from "../patientCgmSync.js";
import type * as patientDexcomSecrets from "../patientDexcomSecrets.js";
import type * as patientGlucose from "../patientGlucose.js";
import type * as patientGuardianPin from "../patientGuardianPin.js";
import type * as patientGuardianPinActions from "../patientGuardianPinActions.js";
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
  "cgm/diagnostics": typeof cgm_diagnostics;
  "cgm/providers": typeof cgm_providers;
  cgmDiagnostics: typeof cgmDiagnostics;
  cgmIngest: typeof cgmIngest;
  crons: typeof crons;
  doctor: typeof doctor;
  doctorAccounts: typeof doctorAccounts;
  "guardianPin/config": typeof guardianPin_config;
  "guardianPin/hashNode": typeof guardianPin_hashNode;
  "guardianPin/internal": typeof guardianPin_internal;
  "guardianPin/validate": typeof guardianPin_validate;
  patientCgm: typeof patientCgm;
  patientCgmSync: typeof patientCgmSync;
  patientDexcomSecrets: typeof patientDexcomSecrets;
  patientGlucose: typeof patientGlucose;
  patientGuardianPin: typeof patientGuardianPin;
  patientGuardianPinActions: typeof patientGuardianPinActions;
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
