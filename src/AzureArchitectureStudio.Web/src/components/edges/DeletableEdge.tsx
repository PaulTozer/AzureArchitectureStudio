import { useEffect, useMemo, useRef, useState } from 'react';
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
import type { AzureEdgeData } from '../../models/diagram';

type Waypoint = { x: number; y: number };

/**
 * Custom edge that:
 *  - Routes through optional `data.waypoints` in flow coordinates so the
 *    user can shape the line for visual clarity.
 *  - Shows draggable handles on every waypoint and "+" insert markers at
 *    each segment midpoint when the edge is selected.
 *  - Shows a × delete button at the path midpoint on hover/select.
 *  - Falls back to the chosen edge style (bezier / smoothstep / step /
 *    straight) when no waypoints exist.
 *
 * Right-clicking a waypoint deletes it.
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
  data,
}: EdgeProps) {
  const { setEdges, screenToFlowPosition } = useReactFlow();

  const [edgeStyle, setEdgeStyle] = useState<EdgeStyle>(() => loadDiagramSettings().edgeStyle);
  useEffect(() => {
    const onChange = () => setEdgeStyle(loadDiagramSettings().edgeStyle);
    window.addEventListener('aas:diagram-settings-changed', onChange);
    return () => window.removeEventListener('aas:diagram-settings-changed', onChange);
  }, []);

  const waypoints: Waypoint[] = useMemo(
    () => (data as AzureEdgeData | undefined)?.waypoints ?? [],
    [data],
  );

  // Build the path. Without waypoints we keep the existing styled router.
  // With waypoints, we draw straight segments through them — once the user
  // manually shapes the line, we honour their points exactly.
  const { edgePath, labelX, labelY } = useMemo(() => {
    if (waypoints.length === 0) {
      const args = { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition };
      switch (edgeStyle) {
        case 'straight': {
          const [p, lx, ly] = getStraightPath(args);
          return { edgePath: p, labelX: lx, labelY: ly };
        }
        case 'step': {
          const [p, lx, ly] = getSmoothStepPath({ ...args, borderRadius: 0 });
          return { edgePath: p, labelX: lx, labelY: ly };
        }
        case 'smoothstep': {
          const [p, lx, ly] = getSmoothStepPath({ ...args, borderRadius: 8 });
          return { edgePath: p, labelX: lx, labelY: ly };
        }
        case 'bezier':
        default: {
          const [p, lx, ly] = getBezierPath(args);
          return { edgePath: p, labelX: lx, labelY: ly };
        }
      }
    }

    // Polyline through source -> waypoints -> target.
    const points: Waypoint[] = [
      { x: sourceX, y: sourceY },
      ...waypoints,
      { x: targetX, y: targetY },
    ];
    const d = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
      .join(' ');

    // Label = midpoint of total path (by length) so the × stays balanced.
    let total = 0;
    const segLens: number[] = [];
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      const len = Math.hypot(dx, dy);
      segLens.push(len);
      total += len;
    }
    let target = total / 2;
    let lx = points[0].x;
    let ly = points[0].y;
    for (let i = 0; i < segLens.length; i++) {
      if (target <= segLens[i]) {
        const t = segLens[i] === 0 ? 0 : target / segLens[i];
        lx = points[i].x + (points[i + 1].x - points[i].x) * t;
        ly = points[i].y + (points[i + 1].y - points[i].y) * t;
        break;
      }
      target -= segLens[i];
    }
    return { edgePath: d, labelX: lx, labelY: ly };
  }, [waypoints, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, edgeStyle]);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEdges((eds) => eds.filter((edge) => edge.id !== id));
  };

  // ---- Waypoint editing ----------------------------------------------------

  const dragRef = useRef<{ index: number; pointerId: number } | null>(null);

  const updateWaypoints = (updater: (current: Waypoint[]) => Waypoint[]) => {
    setEdges((eds) =>
      eds.map((edge) => {
        if (edge.id !== id) return edge;
        const current = ((edge.data as AzureEdgeData | undefined)?.waypoints ?? []) as Waypoint[];
        const next = updater(current);
        return { ...edge, data: { ...(edge.data ?? {}), waypoints: next } };
      }),
    );
  };

  const onWaypointPointerDown = (e: React.PointerEvent, index: number) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = { index, pointerId: e.pointerId };
  };

  const onWaypointPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    updateWaypoints((cur) => {
      if (drag.index < 0 || drag.index >= cur.length) return cur;
      const copy = cur.slice();
      copy[drag.index] = { x: flow.x, y: flow.y };
      return copy;
    });
  };

  const onWaypointPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    try {
      (e.currentTarget as Element).releasePointerCapture(dragRef.current.pointerId);
    } catch {
      /* capture may already be released */
    }
    dragRef.current = null;
  };

  const onWaypointContextMenu = (e: React.MouseEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    updateWaypoints((cur) => cur.filter((_, i) => i !== index));
  };

  const onInsertClick = (e: React.MouseEvent, segmentIndex: number, x: number, y: number) => {
    e.stopPropagation();
    updateWaypoints((cur) => {
      const copy = cur.slice();
      // segmentIndex is the index of the segment between point[segmentIndex]
      // and point[segmentIndex + 1] in the full path. New waypoint inserts at
      // position segmentIndex in the waypoints array (since waypoints are
      // sandwiched between source and target).
      copy.splice(segmentIndex, 0, { x, y });
      return copy;
    });
  };

  // Compute the full point list (including source + target) for the overlays.
  const fullPoints: Waypoint[] = [
    { x: sourceX, y: sourceY },
    ...waypoints,
    { x: targetX, y: targetY },
  ];
  const segmentMidpoints = fullPoints.slice(0, -1).map((p, i) => ({
    x: (p.x + fullPoints[i + 1].x) / 2,
    y: (p.y + fullPoints[i + 1].y) / 2,
  }));

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{ stroke: '#0078d4', strokeWidth: 1.5, ...style }}
        markerEnd={markerEnd}
      />
      <EdgeLabelRenderer>
        {/* Waypoint handles + segment insert markers — only visible when selected. */}
        {selected && (
          <>
            {waypoints.map((wp, i) => (
              <div
                key={`wp-${i}`}
                className="deletable-edge-waypoint nodrag nopan"
                style={{
                  position: 'absolute',
                  transform: `translate(-50%, -50%) translate(${wp.x}px, ${wp.y}px)`,
                }}
                onPointerDown={(e) => onWaypointPointerDown(e, i)}
                onPointerMove={onWaypointPointerMove}
                onPointerUp={onWaypointPointerUp}
                onPointerCancel={onWaypointPointerUp}
                onContextMenu={(e) => onWaypointContextMenu(e, i)}
                title="Drag to move, right-click to remove"
              />
            ))}
            {segmentMidpoints.map((mp, i) => (
              <button
                key={`seg-${i}`}
                type="button"
                className="deletable-edge-insert nodrag nopan"
                style={{
                  position: 'absolute',
                  transform: `translate(-50%, -50%) translate(${mp.x}px, ${mp.y}px)`,
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => onInsertClick(e, i, mp.x, mp.y)}
                title="Add waypoint"
                aria-label="Add waypoint"
              >
                +
              </button>
            ))}
          </>
        )}
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
