import {
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  OverlayDrawer,
  Input,
  Field,
  Switch,
  Button,
} from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import { useAppContext } from '../../context/AppContext';
import type { AzureNode, AzureNodeData } from '../../models';
import { getResourceType, getDisplayName } from '../../models';
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
  const resourceDef = getResourceType(data.typeKey);

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
        {resourceDef && resourceDef.propertySchema.length > 0 ? (
          <SchemaForm
            schema={resourceDef.propertySchema}
            properties={data.properties}
            onChange={handlePropertyChange}
          />
        ) : (
          <p style={{ marginTop: 12, color: 'var(--colorNeutralForeground3)', fontSize: 12 }}>
            {resourceDef
              ? 'No configurable properties for this resource type.'
              : `Resource type "${data.typeKey}" — properties will be available when a definition is added to resource-types.json.`}
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
