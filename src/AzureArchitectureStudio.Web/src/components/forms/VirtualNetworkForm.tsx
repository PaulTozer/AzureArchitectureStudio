import { Field, Input, Button, Tooltip } from '@fluentui/react-components';
import { AddRegular, DeleteRegular } from '@fluentui/react-icons';

interface AddressSpace {
  addressPrefix: string;
}

interface VirtualNetworkFormProps {
  properties: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

export default function VirtualNetworkForm({
  properties,
  onChange,
}: VirtualNetworkFormProps) {
  const ipSpace = (properties.ipSpace as AddressSpace[]) ?? [
    { addressPrefix: '10.0.0.0/16' },
  ];

  const handleAddIpSpace = () => {
    onChange('ipSpace', [...ipSpace, { addressPrefix: '' }]);
  };

  const handleRemoveIpSpace = (index: number) => {
    onChange(
      'ipSpace',
      ipSpace.filter((_, i) => i !== index)
    );
  };

  const handleIpChange = (index: number, value: string) => {
    const updated = [...ipSpace];
    updated[index] = { addressPrefix: value };
    onChange('ipSpace', updated);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Field label="IPv4 Address Space" />
        <Tooltip content="Add an address space" relationship="label">
          <Button
            appearance="subtle"
            icon={<AddRegular />}
            size="small"
            onClick={handleAddIpSpace}
          />
        </Tooltip>
      </div>
      {ipSpace.map((ip, index) => (
        <div key={index} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <Input
            value={ip.addressPrefix}
            onChange={(_, d) => handleIpChange(index, d.value)}
            size="small"
            placeholder="e.g. 10.0.0.0/16"
            style={{ flex: 1 }}
          />
          <Tooltip content="Remove" relationship="label">
            <Button
              appearance="subtle"
              icon={<DeleteRegular />}
              size="small"
              disabled={ipSpace.length <= 1}
              onClick={() => handleRemoveIpSpace(index)}
            />
          </Tooltip>
        </div>
      ))}
    </div>
  );
}
