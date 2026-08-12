import React, { useEffect, useRef, useState } from "react";
import Dropdown, { type Option } from "react-dropdown";
import { withTranslation } from "react-i18next";
import { attachAndKeepMounted, TOP_BAR_SELECTORS } from "../logic/Dom";
import type { TabItemConfig } from "../types/marketplace-types";

type TabOptionConfig = Option & {
  active: boolean;
  enabled: boolean;
};

class TabBarItem extends React.Component<{
  item: TabOptionConfig;
  switchTo: (option: Option) => void;
  t: (key: string) => string;
}> {
  render() {
    const { t } = this.props;
    if (!this.props.item.enabled) return null;

    return (
      <li
        className="marketplace-tabBar-headerItem"
        data-tab={this.props.item.value}
        onClick={(event) => {
          event.preventDefault();
          this.props.switchTo(this.props.item);
        }}
      >
        <a
          aria-current="page"
          className={`marketplace-tabBar-headerItemLink ${this.props.item.active ? "marketplace-tabBar-active" : ""}`}
          draggable="false"
          href="##"
        >
          <span className="main-type-mestoBold">{t(`tabs.${this.props.item.value}`)}</span>
        </a>
      </li>
    );
  }
}

const TabBarItemWithTranslation = withTranslation()(TabBarItem);

interface TabBarMoreProps {
  items: TabOptionConfig[];
  switchTo: (option: Option) => void;
}
const TabBarMore = React.memo<TabBarMoreProps>(function TabBarMore({ items, switchTo }: TabBarMoreProps) {
  return (
    <li className="marketplace-tabBar-headerItem">
      <Dropdown className="main-type-mestoBold" options={items} value="More" placeholder="More" onChange={switchTo} />
    </li>
  );
});

export const TopBarContent = (props: { links: TabItemConfig[]; activeLink: string; switchCallback: (option: Option) => void }) => {
  const tabBar = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = tabBar.current;
    if (!node) return;

    const detach = attachAndKeepMounted(node, TOP_BAR_SELECTORS, {
      onMissing: () => {
        console.warn(`Marketplace: no top bar matched ${TOP_BAR_SELECTORS.join(", ")}; leaving the tab bar inline`);
      }
    });

    return () => {
      detach();
      document.querySelector(".marketplace-tabBar")?.remove();
    };
  }, []);

  return <TabBar ref={tabBar} links={props.links} activeLink={props.activeLink} switchCallback={props.switchCallback} />;
};

interface TabBarProps {
  links: TabItemConfig[];
  activeLink: string;
  switchCallback: (option: Option) => void;
}
const TabBar = React.forwardRef(({ links, activeLink, switchCallback }: TabBarProps, ref: React.ForwardedRef<HTMLElement>) => {
  const tabBarRef = useRef<HTMLUListElement | null>(null);
  const [childrenSizes, setChildrenSizes] = useState([0]);
  const [availableSpace, setAvailableSpace] = useState(0);
  const [droplistItem, setDroplistItems] = useState([0]);

  const options = links.map(({ name, enabled }) => {
    const active = name === activeLink;
    return { label: name, value: name, active, enabled } as TabOptionConfig;
  });

  useEffect(() => {
    if (!tabBarRef.current) return;

    const observer = new ResizeObserver((entries) => setAvailableSpace(entries[0].contentRect.width));
    observer.observe(tabBarRef.current);
    return () => {
      observer.disconnect();
    };
  }, [tabBarRef.current]);

  useEffect(() => {
    if (!tabBarRef.current) return;

    const children = Array.from(tabBarRef.current.children);
    const tabbarItemSizes = children.map((child) => child.clientWidth);

    setChildrenSizes(tabbarItemSizes);
  }, [links]);

  useEffect(() => {
    if (!tabBarRef.current) return;

    const totalSize = childrenSizes.reduce((a, b) => a + b, 0);

    if (totalSize <= availableSpace) {
      setDroplistItems([]);
      return;
    }

    const viewMoreButtonSize = Math.max(...childrenSizes);

    const itemsToHide = [] as number[];
    let stopWidth = viewMoreButtonSize;

    childrenSizes.forEach((childWidth, i) => {
      if (availableSpace >= stopWidth + childWidth) {
        stopWidth += childWidth;
      } else {
        itemsToHide.push(i);
      }
    });

    setDroplistItems(itemsToHide);
  }, [availableSpace, childrenSizes]);

  return (
    <nav className="marketplace-tabBar marketplace-tabBar-nav" ref={ref}>
      <ul className="marketplace-tabBar-header" ref={tabBarRef}>
        {options
          .filter((_, id) => !droplistItem.includes(id))
          .map((item) => (
            <TabBarItemWithTranslation key={item.value} item={item} switchTo={switchCallback} />
          ))}
        {droplistItem.length || childrenSizes.length === 0 ? (
          <TabBarMore items={droplistItem.map((i) => options[i]).filter((i) => i)} switchTo={switchCallback} />
        ) : null}
      </ul>
    </nav>
  );
});
