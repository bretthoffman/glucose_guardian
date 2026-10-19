export * from "./generated/api";
export * from "./generated/api.schemas";
export {
  setDoctorAuthToken,
  setDoctorSessionRejectedHandler,
  setRequestInterceptor,
  customFetch,
  ApiError,
} from "./custom-fetch";
