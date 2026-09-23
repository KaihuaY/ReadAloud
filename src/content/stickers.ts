// The built-in sticker pool for the Blind Box (see src/screens/BlindBox.tsx).
// Common stickers show up often; rare ones are a special surprise. A parent
// can add more via Settings (customStickers, in src/store/progress.ts) - the
// two pools are merged before picking, so uploaded stickers are always in
// the running too.

export interface StickerDef {
  id: string
  emoji: string
  name: string
  rarity: 'common' | 'rare'
  weight: number
}

export const COMMON_WEIGHT = 3
export const RARE_WEIGHT = 1

function common(id: string, emoji: string, name: string): StickerDef {
  return { id, emoji, name, rarity: 'common', weight: COMMON_WEIGHT }
}

function rare(id: string, emoji: string, name: string): StickerDef {
  return { id, emoji, name, rarity: 'rare', weight: RARE_WEIGHT }
}

export const STICKERS: StickerDef[] = [
  common('cat', '🐱', 'Cat'),
  common('dog', '🐶', 'Dog'),
  common('fox', '🦊', 'Fox'),
  common('panda', '🐼', 'Panda'),
  common('koala', '🐨', 'Koala'),
  common('lion', '🦁', 'Lion'),
  common('frog', '🐸', 'Frog'),
  common('bee', '🐝', 'Bee'),
  common('butterfly', '🦋', 'Butterfly'),
  common('ladybug', '🐞', 'Ladybug'),
  common('turtle', '🐢', 'Turtle'),
  common('octopus', '🐙', 'Octopus'),
  common('fish', '🐠', 'Fish'),
  common('penguin', '🐧', 'Penguin'),
  common('owl', '🦉', 'Owl'),
  common('unicorn-face', '🦄', 'Unicorn'),
  common('apple', '🍎', 'Apple'),
  common('cherries', '🍒', 'Cherries'),
  common('watermelon', '🍉', 'Watermelon'),
  common('strawberry', '🍓', 'Strawberry'),
  common('cupcake', '🧁', 'Cupcake'),
  common('donut', '🍩', 'Donut'),
  common('icecream', '🍦', 'Ice Cream'),
  common('cookie', '🍪', 'Cookie'),
  common('balloon', '🎈', 'Balloon'),
  common('kite', '🪁', 'Kite'),
  common('soccer', '⚽', 'Soccer Ball'),
  common('rollerskate', '🛼', 'Roller Skate'),
  common('bicycle', '🚲', 'Bicycle'),
  common('rainbow', '🌈', 'Rainbow'),
  common('sun', '☀️', 'Sunshine'),
  common('star-basic', '⭐', 'Star'),
  common('flower', '🌼', 'Flower'),
  common('four-leaf-clover', '🍀', 'Clover'),
  common('cube', '🧊', 'Ice Cube'),
  rare('unicorn', '🦄✨', 'Sparkle Unicorn'),
  rare('dragon', '🐉', 'Dragon'),
  rare('rocket', '🚀', 'Rocket'),
  rare('shooting-star', '🌠', 'Shooting Star'),
  rare('crown', '👑', 'Crown'),
  rare('trophy', '🏆', 'Trophy'),
  rare('gem', '💎', 'Gem'),
  rare('rainbow-cube', '🌈🧊', 'Rainbow Cube'),
]

export function findSticker(id: string): StickerDef | undefined {
  return STICKERS.find((s) => s.id === id)
}
