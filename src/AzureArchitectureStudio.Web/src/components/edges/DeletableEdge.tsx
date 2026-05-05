import { useEffect, useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react';
import { loadDiagramSettings, type EdgeStyle } from '../../services';

/**
 * Custom edge that shows a small × delete button at its midpoint when
 * hovered or selected. The path style is taken from the user-chosen
 * Diagram setting (bezier / smoothstep / step / straight).
 */
export default function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  selected,
}: EdgeProps) {
  const { setEdges } = useReactFlow();

  const [edgeStyle, setEdgeStyle] = useState<EdgeStyle>(() => loadDiagramSettings().edgeStyle);
  useEffect(() => {
    const onChange = () => setEdgeStyle(loadDiagramSettings().edgeStyle);
    window.addEventListener('aas:diagram-settings-changed', onChange);
    return () => window.removeEventListener('aas:diagram-settings-changed', onChange);
  }, []);

  const pathArgs = {
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  };
  let edgePath: string;
  let labelX: number;
  let labelY: number;
  switch (edgeStyle) {
    case 'straight': {
      const [p, lx, ly] = getStraightPath(pathArgs);
      edgePath = p; labelX = lx; labelY = ly; break;
    }
    case 'step': {
      const [p, lx, ly] = getSmoothStepPath({ ...pathArgs, borderRadius: 0 });
      edgePath = p; labelX = lx; labelY = ly; break;
    }
    case 'smoothstep': {
      const [p, lx, ly] = getSmoothStepPath({ ...pathArgs, borderRadius: 8 });
      edgePath = p; labelX = lx; labelY = ly; break;
    }
    case 'bezier':
    default: {
      const [p, lx, ly] = getBezierPath(pathArgs);
      edgePath = p; labelX = lx; labelY = ly; break;
    }
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEdges((eds) => eds.filter((edge) => edge.id !== id));
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{ stroke: '#0078d4', strokeWidth: 1.5, ...style }}
        markerEnd={markerEnd}
      />
      <EdgeLabelRenderer>
        <div
          className={`deletable-edge-button-container${selected ? ' selected' : ''}`}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          <button
            type="button"
            className="deletable-edge-button nodrag nopan"
            onClick={handleDelete}
            onMouseDown={(e) => e.stopPropagation()}
            title="Delete connection"
            aria-label="Delete connection"
          >
            ×
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
