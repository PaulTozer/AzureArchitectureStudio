import { useEffect, useState } from 'react';
import {
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  OverlayDrawer,
  Input,
  Field,
  Switch,
  Button,
  Spinner,
} from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import { useAppContext } from '../../context/AppContext';
import type { AzureNode, AzureNodeData } from '../../models';
import { getResourceType, getResourceTypeAsync, getDisplayName } from '../../models';
import type { ResourceTypeDefinition } from '../../models';
import SchemaForm from '../forms/SchemaForm';

interface NodeEditDrawerProps {
  node: AzureNode;
  open: boolean;
  onClose: () => void;
}

export default function NodeEditDrawer({
  node,
  open,
  onClose,
}: NodeEditDrawerProps) {
  const { updateNodeData } = useAppContext();
  const data = node.data as AzureNodeData;

  // Try sync first; if missing, resolve async
  const [resourceDef, setResourceDef] = useState<ResourceTypeDefinition | undefined>(
    () => getResourceType(data.typeKey),
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const syncDef = getResourceType(data.typeKey);
    if (syncDef) {
      setResourceDef(syncDef);
      setLoading(false);
      return;
    }

    // Attempt dynamic ARM schema resolution
    let cancelled = false;
    setLoading(true);
    getResourceTypeAsync(data.typeKey).then((def) => {
      if (!cancelled) {
        setResourceDef(def);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [data.typeKey, data.label]);

  const handleChange = (field: keyof AzureNodeData, value: unknown) => {
    updateNodeData(node.id, { [field]: value } as Partial<AzureNodeData>);
  };

  const handlePropertyChange = (key: string, value: unknown) => {
    updateNodeData(node.id, {
      properties: { ...data.properties, [key]: value },
    });
  };

  return (
    <OverlayDrawer position="end" open={open} onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button
              appearance="subtle"
              icon={<DismissRegular />}
              onClick={onClose}
            />
          }
        >
          {getDisplayName(data.typeKey)}
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        {/* Common fields: Name and Location */}
        <Field label="Name" required>
          <Input
            value={data.name}
            onChange={(_, d) => handleChange('name', d.value)}
            size="small"
          />
        </Field>
        <Field label="Location">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch
              checked={data.useResourceGroupLocation}
              onChange={(_, d) =>
                handleChange('useResourceGroupLocation', d.checked)
              }
              label="Use Resource Group location"
            />
          </div>
          {!data.useResourceGroupLocation && (
            <Input
              value={data.location}
              onChange={(_, d) => handleChange('location', d.value)}
              size="small"
              placeholder="e.g. eastus"
              style={{ marginTop: 4 }}
            />
          )}
        </Field>

        {/* Resource-specific properties — driven by registry schema */}
        {loading ? (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Spinner size="tiny" />
            <span style={{ fontSize: 12, color: 'var(--colorNeutralForeground3)' }}>
              Loading resource properties…
            </span>
          </div>
        ) : resourceDef && resourceDef.propertySchema.length > 0 ? (
          <SchemaForm
            schema={resourceDef.propertySchema}
            properties={data.properties}
            onChange={handlePropertyChange}
          />
        ) : (
          <p style={{ marginTop: 12, color: 'var(--colorNeutralForeground3)', fontSize: 12 }}>
            No configurable properties available for this resource type.
          </p>
        )}

        {/* Show ARM type for reference */}
        {resourceDef && (
          <div style={{ marginTop: 16, fontSize: 11, color: 'var(--colorNeutralForeground3)' }}>
            ARM type: {resourceDef.armType} (api {resourceDef.apiVersion})
          </div>
        )}
      </DrawerBody>
    </OverlayDrawer>
  );
}
