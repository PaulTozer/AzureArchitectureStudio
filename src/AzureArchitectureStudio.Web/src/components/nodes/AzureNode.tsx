import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AzureNodeData } from '../../models';
import {
  WarningFilled,
} from '@fluentui/react-icons';
import './AzureNode.css';

function AzureNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as AzureNodeData;
  const isPinned = !!(nodeData.binding && nodeData.binding.corner);
  return (
    <div className={`azure-node ${selected ? 'selected' : ''} ${isPinned ? 'azure-node--bound' : ''}`}>
      {/* Original handle IDs (top/left/right/bottom) are preserved for
          backward-compatibility with already-imported edges that name
          them. ConnectionMode.Loose on the parent ReactFlow lets edges
          start or end on any of these regardless of source/target type. */}
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <img
        src={`/${nodeData.imagePath}`}
        alt={nodeData.name}
        className="azure-node-icon"
        draggable={false}
      />
      {!isPinned && <div className="azure-node-label">{nodeData.name}</div>}
      {!nodeData.isValid && (
        <WarningFilled className="azure-node-warning" />
      )}
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
    </div>
  );
}

export default memo(AzureNodeComponent);
