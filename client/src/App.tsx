import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { AgentPage } from '@/pages/AgentPage';
import { ConnectionsPage } from '@/pages/ConnectionsPage';
import { KnowledgeConnectorPage } from '@/pages/KnowledgeConnectorPage';
import { KnowledgePage } from '@/pages/KnowledgePage';
import { MemoryPage } from '@/pages/MemoryPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { ObsidianPage } from '@/pages/ObsidianPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ToolsPage } from '@/pages/ToolsPage';
import { WorkspacePage } from '@/pages/WorkspacePage';

export function App(): React.JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<WorkspacePage />} />
        <Route path="c/:conversationId" element={<WorkspacePage />} />
        <Route path="agent" element={<AgentPage />} />
        <Route path="memory" element={<MemoryPage />} />
        <Route path="knowledge" element={<KnowledgePage />} />
        <Route path="connections" element={<ConnectionsPage />} />
        <Route path="connections/obsidian" element={<ObsidianPage />} />
        <Route path="connections/:connectorId" element={<KnowledgeConnectorPage />} />
        <Route path="tools" element={<ToolsPage />} />
        <Route path="settings" element={<Navigate to="/settings/general" replace />} />
        <Route path="settings/:section" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
