import { type ReactNode } from "react";
import {
  FaBookOpen,
  FaBuilding,
  FaBullseye,
  FaChartBar,
  FaChartLine,
  FaCommentDots,
  FaGamepad,
  FaGem,
  FaLightbulb,
  FaMapLocationDot,
  FaMoneyBillWave,
  FaNewspaper,
  FaRocket,
  FaTrophy,
} from "react-icons/fa6";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  "📈": FaChartLine,
  "🎯": FaBullseye,
  "🚀": FaRocket,
  "🏢": FaBuilding,
  "💰": FaMoneyBillWave,
  "📊": FaChartBar,
  "📰": FaNewspaper,
  "🗺": FaMapLocationDot,
  "🏆": FaTrophy,
  "🔮": FaGem,
  "💬": FaCommentDots,
  "🎮": FaGamepad,
  "📖": FaBookOpen,
  "💡": FaLightbulb,
};

/** Regex matching all emojis in the map (longest-first to handle multi-char sequences). */
const emojiPattern = new RegExp(
  Object.keys(iconMap)
    .sort((a, b) => b.length - a.length)
    .join("|"),
  "gu"
);

/**
 * Walk a ReactNode tree and replace emoji-text children with inline icon components.
 * Works with any nesting depth (bold, links, etc inside headings/paragraphs).
 */
export function replaceEmojis(children: ReactNode): ReactNode {
  if (typeof children === "string") {
    const parts: ReactNode[] = [];
    let lastIndex = 0;

    for (const match of children.matchAll(emojiPattern)) {
      const emoji = match[0];
      const start = match.index!;

      if (start > lastIndex) {
        parts.push(children.slice(lastIndex, start));
      }

      const Icon = iconMap[emoji];
      if (Icon) {
        parts.push(
          <span
            key={`emoji:${start}`}
            style={{ display: "inline", verticalAlign: "middle", lineHeight: 1 }}
            aria-hidden="true"
          >
            <Icon />
          </span>
        );
      }

      lastIndex = start + emoji.length;
    }

    if (lastIndex < children.length) {
      parts.push(children.slice(lastIndex));
    }

    return parts.length === 1 ? parts[0]! : parts;
  }

  if (Array.isArray(children)) {
    return children.map((child, index) => {
      const processed = replaceEmojis(child);
      if (Array.isArray(processed)) return processed;
      return processed;
    });
  }

  if (children && typeof children === "object" && "props" in children) {
    const element = children as React.ReactElement<{
      children?: ReactNode;
    }>;
    if (element.props?.children) {
      const { children: childProp, ...rest } = element.props;
      return {
        ...element,
        props: {
          ...rest,
          children: replaceEmojis(childProp),
        },
      };
    }
  }

  return children;
}

/**
 * ReactMarkdown `components` override. Wraps every block-level text container
 * so emoji characters get rendered as react-icons instead of raw text.
 */
export const emojiAwareComponents: Record<string, (props: { children?: ReactNode }) => ReactNode> = {
  h1: ({ children }) => <h1>{replaceEmojis(children)}</h1>,
  h2: ({ children }) => <h2>{replaceEmojis(children)}</h2>,
  h3: ({ children }) => <h3>{replaceEmojis(children)}</h3>,
  h4: ({ children }) => <h4>{replaceEmojis(children)}</h4>,
  p: ({ children }) => <p>{replaceEmojis(children)}</p>,
  li: ({ children }) => <li>{replaceEmojis(children)}</li>,
  td: ({ children }) => <td>{replaceEmojis(children)}</td>,
  th: ({ children }) => <th>{replaceEmojis(children)}</th>,
  blockquote: ({ children }) => <blockquote>{replaceEmojis(children)}</blockquote>,
};
