import { memo } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import type { AzureNodeData } from '../../models';
import { getGroupVariant } from '../../models';
import { WarningFilled } from '@fluentui/react-icons';
import './AzureGroup.css';

const variantColors: Record<string, string> = {
  vnet: '#0078d4',
  subnet: '#888888',
  'resource-group': '#a0a0a0',
  subscription: '#0078d4',
};

function AzureGroupComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as AzureNodeData;
  const variant = getGroupVariant(nodeData.typeKey) ?? 'resource-group';
  const resizerColor = variantColors[variant] ?? '#a0a0a0';
  return (
    <div
      className={`azure-group azure-group--${variant} ${selected ? 'selected' : ''}`}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={120}
        minHeight={80}
        lineStyle={{ stroke: resizerColor, strokeWidth: 1 }}
        handleStyle={{ width: 8, height: 8, borderRadius: 2, background: resizerColor, border: 'none' }}
      />
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <div className="azure-group-header">
        {nodeData.imagePath && (
          <img
            src={`/${nodeData.imagePath}`}
            alt={nodeData.name}
            className="azure-group-icon"
            draggable={false}
          />
        )}
        <span className="azure-group-title">{nodeData.name}</span>
        {!nodeData.isValid && (
          <WarningFilled
            className="azure-group-warning"
            title={nodeData.validationSummary || 'This resource has unresolved issues.'}
          />
        )}
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
    </div>
  );
}

export default memo(AzureGroupComponent);
