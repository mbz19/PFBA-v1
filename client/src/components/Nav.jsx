import { NavLink } from 'react-router-dom';
import { Home, PieChart, Repeat, Target, Dumbbell, Settings, Command } from 'lucide-react';
import SaveStatus from './SaveStatus.jsx';

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/budget', label: 'Budget', icon: PieChart },
  { to: '/recurring', label: 'Recurring', icon: Repeat },
  { to: '/goals', label: 'Goals', icon: Target },
  { to: '/workouts', label: 'Workouts', icon: Dumbbell },
  { to: '/settings', label: 'Settings', icon: Settings },
];

// Sidebar on desktop; the same links become a fixed bottom bar on phones (CSS).
export default function Nav() {
  return (
    <nav className="sidebar" aria-label="Primary">
      <div className="brand">
        <span className="dot"><Command size={16} /></span>
        Command Center
      </div>
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
        >
          <Icon size={18} strokeWidth={2} />
          <span className="nav-text">{label}</span>
        </NavLink>
      ))}
      <div className="nav-status"><SaveStatus /></div>
    </nav>
  );
}
