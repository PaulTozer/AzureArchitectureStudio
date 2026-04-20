import { useEffect, useState } from 'react';
import {
  FluentProvider,
  webLightTheme,
  Spinner,
} from '@fluentui/react-components';
import { MsalProvider } from '@azure/msal-react';
import { ReactFlowProvider } from '@xyflow/react';
import { msalInstance } from './services';
import { AppProvider, useAppContext } from './context/AppContext';
import type { StencilModel, AzureServiceModel } from './models';
import { loadResourceTypeRegistry } from './models';
import TopMenu from './components/TopMenu';
import StencilPanel from './components/panels/StencilPanel';
import DiagramPanel from './components/panels/DiagramPanel';
import './App.css';

function AppContent() {
  const { setStencils, setAzureServices } = useAppContext();
  const [loading, setLoading] = useState(true);
  const [siderCollapsed, setSiderCollapsed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // Load resource type registry, legacy stencils, and service catalog in parallel
        const [, stencilRes, servicesRes] = await Promise.all([
          loadResourceTypeRegistry(),
          fetch('/ads-stencils.json'),
          fetch('/azure-services.json'),
        ]);
        const stencilData: StencilModel[] = await stencilRes.json();
        setStencils(stencilData.sort((a, b) => a.label.localeCompare(b.label)));

        const servicesData: AzureServiceModel[] = await servicesRes.json();
        setAzureServices(servicesData);
      } catch (err) {
        console.error('Failed to load services:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [setStencils, setAzureServices]);

  if (loading) {
    return (
      <div className="app-loading">
        <Spinner label="Loading Azure Architecture Studio..." />
      </div>
    );
  }

  return (
    <div className="app-layout">
      <TopMenu />
      <div className="app-body">
        {!siderCollapsed && (
          <div className="app-sider">
            <StencilPanel />
          </div>
        )}
        <button
          className="sider-toggle"
          onClick={() => setSiderCollapsed(!siderCollapsed)}
          title={siderCollapsed ? 'Expand panel' : 'Collapse panel'}
        >
          {siderCollapsed ? '▶' : '◀'}
        </button>
        <div className="app-content">
          <DiagramPanel />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <MsalProvider instance={msalInstance}>
      <FluentProvider theme={webLightTheme} style={{ height: '100%' }}>
        <AppProvider>
          <ReactFlowProvider>
            <AppContent />
          </ReactFlowProvider>
        </AppProvider>
      </FluentProvider>
    </MsalProvider>
  );
}
