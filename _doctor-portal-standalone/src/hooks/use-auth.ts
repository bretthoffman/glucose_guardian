import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";

export function useAuth() {
  const [, setLocation] = useLocation();
  const [accessCode, setAccessCodeState] = useState<string | null>(null);
  const [patientName, setPatientNameState] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const code = sessionStorage.getItem("gg_doc_access_code");
    const name = sessionStorage.getItem("gg_doc_patient_name");
    if (code) {
      setAccessCodeState(code);
      setPatientNameState(name);
    }
    setIsReady(true);
  }, []);

  const login = useCallback((code: string, name?: string) => {
    sessionStorage.setItem("gg_doc_access_code", code);
    if (name) sessionStorage.setItem("gg_doc_patient_name", name);
    setAccessCodeState(code);
    setPatientNameState(name || null);
    setLocation("/dashboard/overview");
  }, [setLocation]);

  const logout = useCallback(() => {
    sessionStorage.removeItem("gg_doc_access_code");
    sessionStorage.removeItem("gg_doc_patient_name");
    setAccessCodeState(null);
    setPatientNameState(null);
    setLocation("/login");
  }, [setLocation]);

  return {
    accessCode,
    patientName,
    isReady,
    isAuthenticated: !!accessCode,
    login,
    logout
  };
}
