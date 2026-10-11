import type { StoreLayout } from '@bosskantaponguttarawichien-boop/wang-raan-core';

/** ผังที่ผ่านกฎทุกข้อ (`ready`) — สร้างจาก factory ของ core แล้วตรึงค่าไว้ */
export function readyLayout(id = 'cafe-1'): StoreLayout {
  return {
    id,
    version: 1,
    units: 'm',
    width: 8,
    depth: 8,
    entrance: { id: 'entrance-01', wall: 'south', position: 3.5, width: 1.2 },
    objects: [
      { id: 'kitchen-01', type: 'kitchen', x: 0, y: 0, width: 2, depth: 1.5, rotation: 0 },
      { id: 'counter-01', type: 'counter', x: 5, y: 0, width: 2.4, depth: 0.7, rotation: 0 },
      {
        id: 'table-01',
        type: 'table',
        preset: 'table-2-seats',
        x: 1,
        y: 4,
        width: 0.8,
        depth: 0.8,
        rotation: 0,
        chairIds: ['chair-01', 'chair-02'],
      },
      { id: 'chair-01', type: 'chair', tableId: 'table-01', x: 1.15, y: 3.6, width: 0.5, depth: 0.5, rotation: 180 },
      { id: 'chair-02', type: 'chair', tableId: 'table-01', x: 1.15, y: 4.7, width: 0.5, depth: 0.5, rotation: 0 },
    ],
  };
}

/** ผังที่ไม่มีทางเข้า — core ตัดสินเป็น `blocked` */
export function blockedLayout(id = 'cafe-blocked'): StoreLayout {
  return { ...readyLayout(id), entrance: null };
}

/** ผังที่มีโต๊ะไม่มีเก้าอี้ — core ตัดสินเป็น `warning` (บันทึกได้) */
export function warningLayout(id = 'cafe-warning'): StoreLayout {
  const layout = readyLayout(id);
  return {
    ...layout,
    objects: [
      ...layout.objects,
      { id: 'table-02', type: 'table', x: 5, y: 4, width: 0.8, depth: 0.8, rotation: 0, chairIds: [] },
    ],
  };
}
