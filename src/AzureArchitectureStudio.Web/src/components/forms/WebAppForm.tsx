import {
  Field,
  RadioGroup,
  Radio,
  Dropdown,
  Option,
} from '@fluentui/react-components';

interface WebAppFormProps {
  properties: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

const runtimeStacks = [
  { label: '.NET 8', value: 'dotnet|v8.0' },
  { label: '.NET 6', value: 'dotnet|v6.0' },
  { label: 'Node 20 LTS', value: 'node|~20' },
  { label: 'Node 18 LTS', value: 'node|~18' },
  { label: 'Java 21', value: 'java|21' },
  { label: 'Java 17', value: 'java|17' },
  { label: 'Python 3.12', value: 'python|3.12' },
  { label: 'Python 3.11', value: 'python|3.11' },
  { label: 'PHP 8.3', value: 'php|8.3' },
];

export default function WebAppForm({ properties, onChange }: WebAppFormProps) {
  const publish = (properties.publish as string) ?? 'code';
  const runtimeStack = (properties.runtimeStack as string) ?? '';
  const os = (properties.os as string) ?? 'linux';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
      <Field label="Publish">
        <RadioGroup
          value={publish}
          onChange={(_, d) => onChange('publish', d.value)}
          layout="horizontal"
        >
          <Radio value="code" label="Code" />
          <Radio value="docker" label="Docker container" />
        </RadioGroup>
      </Field>

      {publish === 'code' && (
        <Field label="Runtime Stack">
          <Dropdown
            value={
              runtimeStacks.find((r) => r.value === runtimeStack)?.label ?? ''
            }
            onOptionSelect={(_, d) => onChange('runtimeStack', d.optionValue)}
            size="small"
          >
            {runtimeStacks.map((r) => (
              <Option key={r.value} value={r.value}>
                {r.label}
              </Option>
            ))}
          </Dropdown>
        </Field>
      )}

      <Field label="Operating System">
        <RadioGroup
          value={os}
          onChange={(_, d) => onChange('os', d.value)}
          layout="horizontal"
        >
          <Radio value="linux" label="Linux" />
          <Radio value="windows" label="Windows" />
        </RadioGroup>
      </Field>
    </div>
  );
}
