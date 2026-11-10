import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './components/RequireAuth';
import { AppLayout } from './layouts/AppLayout';
import { ProjectLayout } from './layouts/ProjectLayout';
import AdminPage from './pages/admin/AdminPage';
import { LoginPage, RegisterPage } from './pages/auth/AuthPages';
import CreateProjectPage from './pages/home/CreateProjectPage';
import HomePage from './pages/home/HomePage';
import NotFoundPage from './pages/NotFoundPage';
import ProfilePage from './pages/profile/ProfilePage';
import ActivityPage from './pages/project/ActivityPage';
import AttachmentsPage from './pages/project/attachments/AttachmentsPage';
import EditorPage from './pages/project/editor/EditorPage';
import ExportsPage from './pages/project/ExportsPage';
import FilesPage from './pages/project/files/FilesPage';
import MembersPage from './pages/project/MembersPage';
import OverviewPage from './pages/project/OverviewPage';
import SettingsPage from './pages/project/SettingsPage';
import TermsPage from './pages/project/TermsPage';
import ToolsPage from './pages/tools/ToolsPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="projects/new" element={<RequireAuth><CreateProjectPage /></RequireAuth>} />
        <Route path="projects/:pid" element={<ProjectLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="editor" element={<EditorPage />} />
          <Route path="files" element={<FilesPage />} />
          <Route path="attachments" element={<AttachmentsPage />} />
          <Route path="terms" element={<TermsPage />} />
          <Route path="members" element={<MembersPage />} />
          <Route path="exports" element={<ExportsPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="." replace />} />
        </Route>
        <Route path="tools" element={<RequireAuth><ToolsPage /></RequireAuth>} />
        <Route path="me" element={<RequireAuth><ProfilePage /></RequireAuth>} />
        <Route path="admin" element={<RequireAuth admin><AdminPage /></RequireAuth>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
