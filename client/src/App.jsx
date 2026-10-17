import './App.css'
import { Route, Routes, Navigate, NavLink, useNavigate, useLocation } from 'react-router-dom'
import Admin from '../components/Admin'
import Login from '../components/Login'
import Profile from '../components/Profile'
import TimeTable from '../components/TimeTable'
import Home from '../components/Home'
import DashBoard from '../components/DashBoard'
import { useState } from 'react'
import { useAuth } from '../context/Auth'
import SignUp from '../components/SignUp'
import VerifyEmail from '../components/VerifyEmail'
import ForgotPassword from '../components/ForgotPassword'
import Venues from '../components/Venues'
import Notifications from '../components/Notifications'
import Academics from '../components/Academics'

function PrivateRoute({ children }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}

function AdminRoute({ children }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (user.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

function App() {
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const [navBar, setNavBar] = useState(false);

  function handleLogout() {
    localStorage.removeItem("userToken");
    localStorage.removeItem("userProfile");
    setUser(null);
    setNavBar(false);
    nav('/login');
  }

  return (
    <>
      <div className={`webpage ${navBar ? 'nav-open' : ''}`}>
        <aside className={`navbar ${navBar ? 'open' : ''}`}>
          <div id="head">
            <h1>SMART<span className="gold">SCHED</span><span className="teal">ULE</span></h1>
            <div className="nav-accent-bars" aria-hidden="true">
              <span></span><span></span><span></span><span></span><span></span>
            </div>
          </div>
          <ul onClick={() => setNavBar(false)}>
            {!user && <li><NavLink to="/login">Login</NavLink></li>}
            <li><NavLink to="/dashboard">Dashboard</NavLink></li>
            <li><NavLink to="/timetable">Timetable</NavLink></li>
            <li><NavLink to="/venues">Venues</NavLink></li>
            <li><NavLink to="/academics">Academics</NavLink></li>
            <li><NavLink to="/profile">Profile</NavLink></li>
            {user?.role === "admin" && <li><NavLink to="/admin">Admin</NavLink></li>}
            {user && (
              <li>
                <button className="logout-btn" onClick={handleLogout}>LOGOUT</button>
              </li>
            )}
          </ul>
        </aside>
        {navBar && <button className="nav-backdrop" type="button" aria-label="Close menu" onClick={() => setNavBar(false)} />}
        <main className="main-content">
          <div className="page-body">
            <Notifications />
            <button
              className="menu-toggle-btn"
              onClick={() => setNavBar(!navBar)}
              aria-label={navBar ? 'Close menu' : 'Open menu'}
              aria-expanded={navBar}
            >
              <span aria-hidden="true"></span>
              <span aria-hidden="true"></span>
              <span aria-hidden="true"></span>
              {navBar ? '✕' : '≡'}
            </button>
            <Routes>
              <Route path='/login' element={<Login />} />
              <Route path="/signup" element={<SignUp />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />

              <Route path='/profile' element={<PrivateRoute><Profile /></PrivateRoute>} />
              <Route path='/timetable' element={<PrivateRoute><TimeTable year={"2025-26"} /></PrivateRoute>} />
              <Route path='/venues' element={<PrivateRoute><Venues /></PrivateRoute>} />
              <Route path='/academics' element={<PrivateRoute><Academics /></PrivateRoute>} />
              <Route path='/dashboard' element={<PrivateRoute><DashBoard /></PrivateRoute>} />
              <Route path='/admin' element={<AdminRoute><Admin /></AdminRoute>} />

              <Route path='*' element={<Home />} />
            </Routes>
          </div>
          <footer className="app-footer">
            Made with <span className="heart">♥</span> by <span>  </span>
            <a href="https://github.com/orgs/WastedPotential-Labs/people" target="_blank" rel="noopener noreferrer">
             Team Wasted Potential
            </a>
          </footer>
        </main>
      </div>
    </>
  )
}

export default App