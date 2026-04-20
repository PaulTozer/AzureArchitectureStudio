import { useState, useMemo } from 'react';
import {
  TabList,
  Tab,
  Tooltip,
  Button,
  Input,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  DialogActions,
  Badge,
} from '@fluentui/react-components';
import {
  SearchRegular,
  DismissRegular,
  QuestionCircleRegular,
} from '@fluentui/react-icons';
import { useAppContext } from '../../context/AppContext';
import type { AzureServiceModel } from '../../models';
import StencilItem from './StencilItem';
import './StencilPanel.css';

export default function StencilPanel() {
  const { azureServices } = useAppContext();
  const [activeTab, setActiveTab] = useState('All');
  const [searchText, setSearchText] = useState('');

  // Derive categories from loaded services
  const categories = useMemo(() => {
    const cats = new Set(azureServices.map((s) => s.category));
    return ['All', ...Array.from(cats).sort()];
  }, [azureServices]);

  // Filter services by category and search
  const filteredServices = useMemo(() => {
    let result = azureServices;
    if (activeTab !== 'All') {
      result = result.filter((s) => s.category === activeTab);
    }
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.key.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q)
      );
    }
    return result;
  }, [azureServices, activeTab, searchText]);

  // Count per category for badges
  const countByCategory = useMemo(() => {
    const map: Record<string, number> = { All: azureServices.length };
    for (const s of azureServices) {
      map[s.category] = (map[s.category] || 0) + 1;
    }
    return map;
  }, [azureServices]);

  return (
    <div className="stencil-panel">
      <div className="stencil-sidebar">
        <div className="stencil-search">
          <Input
            size="small"
            contentBefore={<SearchRegular />}
            contentAfter={
              searchText ? (
                <Button
                  appearance="transparent"
                  icon={<DismissRegular />}
                  size="small"
                  onClick={() => setSearchText('')}
                  style={{ minWidth: 'auto', padding: 0 }}
                />
              ) : undefined
            }
            placeholder="Search services..."
            value={searchText}
            onChange={(_, d) => setSearchText(d.value)}
          />
        </div>
        <TabList
          vertical
          size="small"
          selectedValue={activeTab}
          onTabSelect={(_, d) => setActiveTab(d.value as string)}
          className="stencil-tabs"
        >
          {categories.map((cat) => (
            <Tab key={cat} value={cat}>
              <span className="stencil-tab-label">
                {cat}
                <Badge
                  size="small"
                  appearance="filled"
                  color="informative"
                  className="stencil-tab-badge"
                >
                  {countByCategory[cat] || 0}
                </Badge>
              </span>
            </Tab>
          ))}
        </TabList>
      </div>
      <div className="stencil-panel-content">
        <div className="stencil-results-header">
          {filteredServices.length} service{filteredServices.length !== 1 ? 's' : ''}
        </div>
        <div className="stencil-grid">
          {filteredServices.map((service) => (
            <ServiceStencilItem key={service.key} service={service} />
          ))}
        </div>
      </div>
      <div className="stencil-panel-footer">
        <AboutDialog />
      </div>
    </div>
  );
}

function ServiceStencilItem({ service }: { service: AzureServiceModel }) {
  const { setDraggedStencilKey } = useAppContext();

  const handleDragStart = (e: React.DragEvent) => {
    setDraggedStencilKey(service.key);
    e.dataTransfer.setData('application/azure-stencil', service.key);
    e.dataTransfer.setData('application/azure-stencil-icon', service.iconPath);
    e.dataTransfer.setData('application/azure-stencil-name', service.name);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <Tooltip content={`${service.name} (${service.category})`} relationship="description">
      <div className="stencil-item" draggable onDragStart={handleDragStart}>
        <img
          src={`/${service.iconPath}`}
          alt={service.name}
          className="stencil-icon"
          draggable={false}
        />
        <span className="stencil-label">{service.name}</span>
      </div>
    </Tooltip>
  );
}

function AboutDialog() {
  return (
    <Dialog>
      <DialogTrigger disableButtonEnhancement>
        <Tooltip content="About" relationship="label">
          <Button
            appearance="subtle"
            icon={<QuestionCircleRegular />}
            size="small"
          />
        </Tooltip>
      </DialogTrigger>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>About</DialogTitle>
          <DialogContent>
            <p>
              <strong>Azure Architecture Studio</strong>
            </p>
            <p>
              A visual designer for Azure architecture diagrams with ARM/Bicep
              export support.
            </p>
            <p>
              <strong>Disclaimer:</strong> This app is a personal project
              without any warranty. Use it at your own risk.
            </p>
          </DialogContent>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="secondary">Close</Button>
            </DialogTrigger>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
