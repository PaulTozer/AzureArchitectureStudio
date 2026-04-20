interface GenericFormProps {
  typeKey: string;
  properties: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

export default function GenericForm({ typeKey }: GenericFormProps) {
  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ fontSize: 12, color: 'var(--colorNeutralForeground3)' }}>
        Configure this resource's properties in the exported ARM/Bicep template.
      </p>
    </div>
  );
}
