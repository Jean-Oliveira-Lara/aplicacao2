import type { ReactNode } from 'react';
import BottomNav from './BottomNav';
import './AppShell.css';

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell">
      <main className="app-shell__content">{children}</main>
      <BottomNav />
    </div>
  );
}
