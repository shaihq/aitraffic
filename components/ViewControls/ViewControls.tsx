'use client';

import type { CameraLevel } from '@/scene/CameraController/CameraController';
import { Segmented } from '../ui/Segmented';
import { IconMap, IconStreet, IconTarget } from '../ui/icons';

interface Props {
  level: CameraLevel;
  canFocus: boolean;
  onLevel: (level: CameraLevel) => void;
}

/** Vertical camera-level switch for the right-hand rail. */
export function ViewControls({ level, canFocus, onLevel }: Props) {
  return (
    <Segmented
      vertical
      label="Camera level"
      value={level}
      onChange={onLevel}
      className="rail__views"
      items={[
        { value: 'overview' as CameraLevel, ariaLabel: 'Whole city', label: <IconMap /> },
        { value: 'district' as CameraLevel, ariaLabel: 'Neighbourhood', label: <IconTarget />, disabled: !canFocus },
        { value: 'street' as CameraLevel, ariaLabel: 'Street level', label: <IconStreet />, disabled: !canFocus },
      ]}
    />
  );
}
