import { NavLink } from 'react-router-dom';
import './BottomNav.css';

export default function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Navegação principal">
      <NavLink
        to="/"
        end
        className={({ isActive }) => `bottom-nav__item${isActive ? ' bottom-nav__item--active' : ''}`}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="bottom-nav__icon">
          <path
            d="M4 11.5 12 4l8 7.5M6 9.8V20h12V9.8"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>Início</span>
      </NavLink>
      <NavLink
        to="/recentes"
        className={({ isActive }) => `bottom-nav__item${isActive ? ' bottom-nav__item--active' : ''}`}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="bottom-nav__icon">
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
          <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Recentes</span>
      </NavLink>
      <NavLink
        to="/financeiro"
        className={({ isActive }) => `bottom-nav__item${isActive ? ' bottom-nav__item--active' : ''}`}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="bottom-nav__icon">
          <rect x="3.5" y="6" width="17" height="12.5" rx="2.5" stroke="currentColor" strokeWidth="2" />
          <path d="M3.5 10h17M7.5 14.5h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span>Financeiro</span>
      </NavLink>
    </nav>
  );
}
