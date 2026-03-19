// src/index.tsx
import { createContext, useContext } from "react";
import { jsx } from "react/jsx-runtime";
function createContextHook(contextInitializer, defaultValue) {
  const Context = createContext(defaultValue);
  return [
    ({ children }) => /* @__PURE__ */ jsx(Context.Provider, { value: contextInitializer(), children }),
    () => useContext(Context)
  ];
}
export {
  createContextHook as default
};
