import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { I18nProvider } from './i18n/I18nContext'
import { ShellLayout } from './components/ShellLayout'
import { MapDashboardPage } from './pages/MapDashboardPage'
import { CommunityFeedPage } from './pages/CommunityFeedPage'
import { ProfilePage } from './pages/ProfilePage'
import { BorderDetailPage } from './pages/BorderDetailPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { LegalPage } from './pages/LegalPage'
import { GroupsPage } from './pages/GroupsPage'
import { GroupChatPage } from './pages/GroupChatPage'

export default function App() {
  return (
    <I18nProvider>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/legal/:doc" element={<LegalPage />} />
        <Route path="/" element={<ShellLayout />}>
          <Route index element={<MapDashboardPage />} />
          <Route path="community" element={<CommunityFeedPage />} />
          <Route path="groups" element={<GroupsPage />} />
          <Route path="groups/:id" element={<GroupChatPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
        <Route path="/border/:slug" element={<BorderDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </I18nProvider>
  )
}
