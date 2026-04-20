import { Field, Input } from '@fluentui/react-components';

interface SqlServerFormProps {
  properties: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

export default function SqlServerForm({ properties, onChange }: SqlServerFormProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
      <p style={{ fontSize: 12, color: 'var(--colorNeutralForeground3)' }}>
        The SQL admin credentials will be exported as ARM template parameters.
      </p>
    </div>
  );
}
