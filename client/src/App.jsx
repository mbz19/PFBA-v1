import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './state.jsx';
import Nav from './components/Nav.jsx';
import Gate from './components/Gate.jsx';

import Home from './pages/Home.jsx';
import Budget from './pages/Budget.jsx';
import Recurring from './pages/Recurring.jsx';
import Goals from './pages/Goals.jsx';
import Workouts from './pages/Workouts.jsx';
import Settings from './pages/Settings.jsx';

function Shell() {
  const { phase } = useApp();
  if (phase !== 'ready') return <Gate />;
  return (
    <div className="app">
      <Nav />
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/budget" element={<Budget />} />
          <Route path="/recurring" element={<Recurring />} />
          <Route path="/goals" element={<Goals />} />
          <Route path="/workouts" element={<Workouts />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
