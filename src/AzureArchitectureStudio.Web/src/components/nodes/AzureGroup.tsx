import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AzureNodeData } from '../../models';
import { getGroupVariant } from '../../models';
import { WarningFilled } from '@fluentui/react-icons';
import './AzureGroup.css';

function AzureGroupComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as AzureNodeData;
  const variant = getGroupVariant(nodeData.typeKey) ?? 'resource-group';
  return (
    <div
      className={`azure-group azure-group--${variant} ${selected ? 'selected' : ''}`}
    >
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
          <WarningFilled className="azure-group-warning" />
        )}
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
    </div>
  );
}

export default memo(AzureGroupComponent);
