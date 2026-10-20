import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Universal from './pages/Universal.jsx';
import MediaPage from './pages/MediaPage.jsx';
import SocialMedia from './pages/SocialMedia.jsx';
import Collections from './pages/Collections.jsx';
import Batch from './pages/Batch.jsx';
import Queue from './pages/Queue.jsx';
import History from './pages/History.jsx';
import Library from './pages/Library.jsx';
import Platforms from './pages/Platforms.jsx';
import Settings from './pages/Settings.jsx';
import About from './pages/About.jsx';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="universal" element={<Universal />} />
          <Route path="video" element={<MediaPage kind="video" />} />
          <Route path="audio" element={<MediaPage kind="audio" />} />
          <Route path="image" element={<MediaPage kind="image" />} />
          <Route path="social" element={<SocialMedia />} />
          <Route path="collections" element={<Collections />} />
          <Route path="batch" element={<Batch />} />
          <Route path="queue" element={<Queue />} />
          <Route path="history" element={<History />} />
          <Route path="library" element={<Library />} />
          <Route path="platforms" element={<Platforms />} />
          <Route path="settings" element={<Settings />} />
          <Route path="about" element={<About />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
