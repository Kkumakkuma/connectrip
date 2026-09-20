import { MENU_ICONS } from '../lib/menuIcons';

// 메뉴·게시판 탭 공용 컬러 아이콘. 표는 src/lib/menuIcons.js (설명도 거기).
// id 가 표에 없으면 아무것도 그리지 않는다(빈 네모·깨진 이미지 아이콘을 내지 않게).
const MenuIcon = ({ id, size = 18, className = '' }) => {
  const src = MENU_ICONS[id];
  if (!src) return null;
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      className={`shrink-0 select-none ${className}`}
    />
  );
};

export default MenuIcon;
