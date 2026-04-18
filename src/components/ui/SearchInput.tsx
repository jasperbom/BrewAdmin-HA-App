import React from 'react'

interface SearchInputProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  cls?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

const SearchInput: React.FC<SearchInputProps> = ({ value, onChange, placeholder = '', cls = '', onKeyDown }) => (
  <input
    type="text"
    value={value}
    onChange={e => onChange(e.target.value)}
    placeholder={placeholder}
    onKeyDown={onKeyDown}
    className={`w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none transition-all duration-150 shadow-sm placeholder-gray-300 ${cls}`}
  />
)

export default SearchInput
