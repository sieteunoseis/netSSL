export const customSelectStyles = {
    control: (baseStyles, state) => ({
      ...baseStyles,
      backgroundColor: 'hsl(var(--background))',
      borderColor: 'hsl(var(--input))',
      borderRadius: 'calc(var(--radius) - 2px)',
      minHeight: '40px',
      fontSize: '0.875rem', // 14px to match shadcn
      lineHeight: '1.25rem',
      fontFamily: 'var(--font-sans)',
      boxShadow: state.isFocused ? 'none' : baseStyles.boxShadow,
      borderWidth: '1px',
      padding: '2px',
      '&:hover': {
        borderColor: 'hsl(var(--input))',
      },
      '&:focus-within': {
        borderColor: 'hsl(var(--ring))',
        boxShadow: 'rgb(0 0 0 / 0) 0px 0px 0px 0px, rgb(0 0 0 / 0) 0px 0px 0px 0px, hsl(var(--ring)) 0px 0px 0px 1.5px',
        outline: 'none'
      }
    }),
    placeholder: (baseStyles) => ({
      ...baseStyles,
      color: 'hsl(var(--muted-foreground))',
      fontSize: '0.875rem',
      lineHeight: '1.25rem',
    }),
    input: (baseStyles) => ({
      ...baseStyles,
      color: 'hsl(var(--foreground))',
      fontSize: '0.875rem',
      lineHeight: '1.25rem',
    }),
    menu: (baseStyles) => ({
      ...baseStyles,
      backgroundColor: 'hsl(var(--background))',
      border: '1px solid hsl(var(--input))',
      borderRadius: 'calc(var(--radius) - 2px)',
      boxShadow: '0px 10px 38px -10px rgba(22, 23, 24, 0.35), 0px 10px 20px -15px rgba(22, 23, 24, 0.2)',
      fontSize: '0.875rem',
      lineHeight: '1.25rem',
    }),
    option: (baseStyles, state) => ({
      ...baseStyles,
      backgroundColor: state.isFocused 
        ? 'hsl(var(--accent))' 
        : state.isSelected 
          ? 'hsl(var(--accent))' 
          : 'hsl(var(--background))',
      color: state.isFocused || state.isSelected 
        ? 'hsl(var(--accent-foreground))' 
        : 'hsl(var(--foreground))',
      cursor: 'pointer',
      fontSize: '0.875rem',
      lineHeight: '1.25rem',
      padding: '8px 12px',
      '&:active': {
        backgroundColor: 'hsl(var(--accent))',
      }
    }),
    singleValue: (baseStyles) => ({
      ...baseStyles,
      color: 'hsl(var(--foreground))',
      fontSize: '0.875rem',
      lineHeight: '1.25rem',
    }),
    multiValue: (baseStyles) => ({
      ...baseStyles,
      backgroundColor: 'hsl(var(--accent))',
      borderRadius: 'calc(var(--radius) - 4px)',
      fontSize: '0.875rem',
      lineHeight: '1.25rem',
    }),
    multiValueLabel: (baseStyles) => ({
      ...baseStyles,
      color: 'hsl(var(--accent-foreground))',
      fontSize: '0.875rem',
      lineHeight: '1.25rem',
    }),
    multiValueRemove: (baseStyles) => ({
      ...baseStyles,
      color: 'hsl(var(--accent-foreground))',
      ':hover': {
        backgroundColor: 'hsl(var(--destructive))',
        color: 'hsl(var(--destructive-foreground))',
      },
    }),
  };
  
  export const selectClassNames = {
    control: () => "border-input",
    placeholder: () => "text-muted-foreground",
    input: () => "text-sm",
    option: () => "text-sm"
  };
  
  export const inputGroupSelectStyles = {
    ...customSelectStyles,
    control: (baseStyles, state) => ({
      ...baseStyles,
      borderTopLeftRadius: 0,
      borderBottomLeftRadius: 0,
      backgroundColor: 'hsl(var(--background))',
      borderColor: 'hsl(var(--input))',
      minHeight: '40px',
      fontSize: '0.875rem',
      lineHeight: '1.25rem',
      fontFamily: 'var(--font-sans)',
      boxShadow: state.isFocused ? 'none' : baseStyles.boxShadow,
      borderWidth: '1px',
      padding: '2px',
      '&:hover': {
        borderColor: 'hsl(var(--input))',
      },
      '&:focus-within': {
        borderColor: 'hsl(var(--ring))',
        boxShadow: 'rgb(0 0 0 / 0) 0px 0px 0px 0px, rgb(0 0 0 / 0) 0px 0px 0px 0px, hsl(var(--ring)) 0px 0px 0px 1.5px',
        outline: 'none'
      }
    })
  };