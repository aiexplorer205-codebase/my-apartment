import React from 'react'
import { getBrand } from '../branding'
import { getAppConfig } from '../config'

export interface BrandLogoProps {
  brandId?: string
  variant?: 'light' | 'dark'
  size?: number
  className?: string
  alt?: string
}

export function BrandLogo({
  brandId = 'default',
  variant = 'light',
  size = 32,
  className = '',
  alt,
}: BrandLogoProps) {
  const brand = getBrand(brandId)
  const src = variant === 'dark' ? brand.assets.logoDark : brand.assets.logo
  const altText = alt ?? `${getAppConfig().application.productName} logo`

  return (
    <img
      src={src}
      alt={altText}
      width={size}
      height={size}
      className={`nivasa-brand-logo ${className}`.trim()}
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    />
  )
}

