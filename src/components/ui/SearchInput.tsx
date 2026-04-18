import React from 'react'

interface SearchInputProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  cls?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

const SearchInput: React.FC<SearchInputProps> = ({ value, onChange, placeholder = '', cls = '', onKeyDown }) => (
  <div className="relative w-full">
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
      className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.3-4.3m0 0a7 7 0 1 0-9.9-9.9 7 7 0 0 0 9.9 9.9Z" />
    </svg>
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      onKeyDown={onKeyDown}
      className={`w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm bg-white t-input outline-none transition-all duration-150 shadow-sm placeholder-gray-300 ${cls}`}
    />
  </div>
)

export default SearchInput
