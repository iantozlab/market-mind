import type { ReactNode } from "react";

const AuthGate = ({ children }: { children: ReactNode }) => {
  return <>{children}</>;
};

export default AuthGate;
