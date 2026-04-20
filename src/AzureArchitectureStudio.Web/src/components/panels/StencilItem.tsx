import { Tooltip } from '@fluentui/react-components';
import type { StencilModel } from '../../models';
import { useAppContext } from '../../context/AppContext';
import './StencilItem.css';

interface StencilItemProps {
  model: StencilModel;
}

export default function StencilItem({ model }: StencilItemProps) {
  const { setDraggedStencilKey } = useAppContext();

  const handleDragStart = (e: React.DragEvent) => {
    setDraggedStencilKey(model.key);
    e.dataTransfer.setData('application/azure-stencil', model.key);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <Tooltip content={model.label} relationship="description">
      <div
        className="stencil-item"
        draggable
        onDragStart={handleDragStart}
      >
        <img
          src={`/${model.iconPath}`}
          alt={model.label}
          className="stencil-icon"
          draggable={false}
        />
        <span className="stencil-label">{model.label}</span>
      </div>
    </Tooltip>
  );
}
