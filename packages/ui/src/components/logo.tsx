import { type ComponentProps } from "solid-js"
import brandIcon from "../assets/brand/app-icon.png"

type BrandImgProps = Omit<ComponentProps<"img">, "src">

export const Mark = (props: BrandImgProps) => {
  return (
    <img
      data-component="logo-mark"
      {...props}
      src={brandIcon}
      alt={props.alt ?? "NekoCode"}
      draggable={false}
    />
  )
}

export const Splash = (props: BrandImgProps) => {
  return (
    <img
      data-component="logo-splash"
      {...props}
      class={`object-contain ${props.class ?? ""}`}
      src={brandIcon}
      alt={props.alt ?? "NekoCode"}
      draggable={false}
    />
  )
}

export const Logo = (props: BrandImgProps) => {
  return (
    <img
      data-component="logo"
      {...props}
      src={brandIcon}
      alt={props.alt ?? "NekoCode"}
      draggable={false}
    />
  )
}
