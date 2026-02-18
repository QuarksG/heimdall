import React from 'react';
import type { HeaderProps } from '../types/crtr.types';

export const Header = React.memo(({ onSearch }: HeaderProps) => (
  <header id="mainHeader" className="head">
    <input type="text" placeholder="Search..." className="sch-in" onChange={(e) => onSearch(e.target.value)} />
  </header>
));